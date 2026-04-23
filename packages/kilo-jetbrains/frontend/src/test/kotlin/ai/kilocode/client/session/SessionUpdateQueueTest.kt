package ai.kilocode.client.session

import ai.kilocode.client.session.model.Tool
import ai.kilocode.client.session.model.ToolExecState
import ai.kilocode.client.session.model.SessionModelEvent
import ai.kilocode.client.session.model.SessionState
import ai.kilocode.rpc.dto.ChatEventDto

class SessionUpdateQueueTest : SessionControllerTestBase() {

    fun `test hidden controller buffers until shown`() {
        appRpc.state.value = ai.kilocode.rpc.dto.KiloAppStateDto(ai.kilocode.rpc.dto.KiloAppStatusDto.READY)
        projectRpc.state.value = workspaceReady()
        val m = controller("ses_test", flushMs = 250L)
        val modelEvents = collectModelEvents(m)
        flush()
        modelEvents.clear()

        hide(m)
        emit(ChatEventDto.TurnOpen("ses_test"), flush = false)
        emit(ChatEventDto.MessageUpdated("ses_test", msg("msg1", "ses_test", "assistant")), flush = false)
        settle()

        assertTrue(modelEvents.isEmpty())
        assertEquals(SessionState.Idle, m.model.state)

        show(m)
        settle()
        flush()

        assertModelEvents("""
            StateChanged Busy
            MessageAdded msg1
            TurnAdded msg1 [msg1]
        """, modelEvents)
        assertTrue(m.model.state is SessionState.Busy)
    }

    fun `test buffered deltas coalesce into one model delta`() {
        appRpc.state.value = ai.kilocode.rpc.dto.KiloAppStateDto(ai.kilocode.rpc.dto.KiloAppStatusDto.READY)
        projectRpc.state.value = workspaceReady()
        val m = controller("ses_test", flushMs = Long.MAX_VALUE)
        val modelEvents = collectModelEvents(m)
        flush()
        modelEvents.clear()

        emit(ChatEventDto.MessageUpdated("ses_test", msg("msg1", "ses_test", "assistant")))
        modelEvents.clear()

        emit(ChatEventDto.PartDelta("ses_test", "msg1", "prt1", "text", "hello "), flush = false)
        emit(ChatEventDto.PartDelta("ses_test", "msg1", "prt1", "text", "world"), flush = false)
        settle()
        flush()

        assertEquals(1, modelEvents.count { it is SessionModelEvent.ContentAdded })
        val delta = modelEvents.filterIsInstance<SessionModelEvent.ContentDelta>()
        assertEquals(1, delta.size)
        assertModel(
            """
            assistant#msg1
            text#prt1:
              hello world
            """,
            m,
        )
        assertEquals(listOf("hello world"), delta.map { it.delta })
    }

    fun `test visible controller flushes after cadence`() {
        appRpc.state.value = ai.kilocode.rpc.dto.KiloAppStateDto(ai.kilocode.rpc.dto.KiloAppStatusDto.READY)
        projectRpc.state.value = workspaceReady()
        val m = controller("ses_test", flushMs = 50L)
        val modelEvents = collectModelEvents(m)
        flush()
        modelEvents.clear()

        emit(ChatEventDto.TurnOpen("ses_test"), flush = false)
        flush()

        assertTrue(modelEvents.any { it is SessionModelEvent.StateChanged })
        assertTrue(m.model.state is SessionState.Busy)
    }

    fun `test buffered part updates for new part collapse to one content add`() {
        appRpc.state.value = ai.kilocode.rpc.dto.KiloAppStateDto(ai.kilocode.rpc.dto.KiloAppStatusDto.READY)
        projectRpc.state.value = workspaceReady()
        val m = controller("ses_test", flushMs = Long.MAX_VALUE)
        val modelEvents = collectModelEvents(m)
        flush()
        modelEvents.clear()

        emit(ChatEventDto.MessageUpdated("ses_test", msg("msg1", "ses_test", "assistant")))
        modelEvents.clear()

        emit(ChatEventDto.PartUpdated("ses_test", part("prt1", "ses_test", "msg1", "tool", tool = "bash", state = "pending")), flush = false)
        emit(ChatEventDto.PartUpdated("ses_test", part("prt1", "ses_test", "msg1", "tool", tool = "bash", state = "completed")), flush = false)
        settle()
        flush()

        assertEquals(1, modelEvents.count { it is SessionModelEvent.ContentAdded })
        assertEquals(0, modelEvents.count { it is SessionModelEvent.ContentUpdated })
        val tool = m.model.message("msg1")!!.parts["prt1"] as Tool
        assertEquals(ToolExecState.COMPLETED, tool.state)
    }

    fun `test buffered part updates for existing part collapse to one content update`() {
        appRpc.state.value = ai.kilocode.rpc.dto.KiloAppStateDto(ai.kilocode.rpc.dto.KiloAppStatusDto.READY)
        projectRpc.state.value = workspaceReady()
        val m = controller("ses_test", flushMs = Long.MAX_VALUE)
        val modelEvents = collectModelEvents(m)
        flush()
        modelEvents.clear()

        emit(ChatEventDto.MessageUpdated("ses_test", msg("msg1", "ses_test", "assistant")))
        emit(ChatEventDto.PartUpdated("ses_test", part("prt1", "ses_test", "msg1", "tool", tool = "bash", state = "pending")))
        modelEvents.clear()

        emit(ChatEventDto.PartUpdated("ses_test", part("prt1", "ses_test", "msg1", "tool", tool = "bash", state = "running")), flush = false)
        emit(ChatEventDto.PartUpdated("ses_test", part("prt1", "ses_test", "msg1", "tool", tool = "bash", state = "completed", title = "Install deps")), flush = false)
        settle()
        flush()

        assertEquals(0, modelEvents.count { it is SessionModelEvent.ContentAdded })
        assertEquals(1, modelEvents.count { it is SessionModelEvent.ContentUpdated })
        val tool = m.model.message("msg1")!!.parts["prt1"] as Tool
        assertEquals(ToolExecState.COMPLETED, tool.state)
        assertEquals("Install deps", tool.title)
    }

    fun `test buffered same part tool updates keep only final busy text`() {
        appRpc.state.value = ai.kilocode.rpc.dto.KiloAppStateDto(ai.kilocode.rpc.dto.KiloAppStatusDto.READY)
        projectRpc.state.value = workspaceReady()
        val m = controller("ses_test", flushMs = Long.MAX_VALUE)
        val modelEvents = collectModelEvents(m)
        flush()
        modelEvents.clear()

        emit(ChatEventDto.TurnOpen("ses_test"))
        emit(ChatEventDto.MessageUpdated("ses_test", msg("msg1", "ses_test", "assistant")))
        modelEvents.clear()

        emit(ChatEventDto.PartUpdated("ses_test", part("prt1", "ses_test", "msg1", "tool", tool = "read", state = "running")), flush = false)
        emit(ChatEventDto.PartUpdated("ses_test", part("prt1", "ses_test", "msg1", "tool", tool = "bash", state = "running")), flush = false)
        settle()
        flush()

        val busy = modelEvents.filterIsInstance<SessionModelEvent.StateChanged>()
            .filter { it.state is SessionState.Busy }
        assertEquals(1, busy.size)
        val state = busy.single().state as SessionState.Busy
        assertTrue(state.text.contains("commands", ignoreCase = true))
    }

    fun `test barrier prevents part update merge across turn close`() {
        appRpc.state.value = ai.kilocode.rpc.dto.KiloAppStateDto(ai.kilocode.rpc.dto.KiloAppStatusDto.READY)
        projectRpc.state.value = workspaceReady()
        val m = controller("ses_test", flushMs = Long.MAX_VALUE)
        val modelEvents = collectModelEvents(m)
        flush()
        modelEvents.clear()

        emit(ChatEventDto.MessageUpdated("ses_test", msg("msg1", "ses_test", "assistant")))
        emit(ChatEventDto.TurnOpen("ses_test"))
        modelEvents.clear()

        emit(ChatEventDto.PartUpdated("ses_test", part("prt1", "ses_test", "msg1", "tool", tool = "bash", state = "running")), flush = false)
        emit(ChatEventDto.TurnClose("ses_test", "completed"), flush = false)
        emit(ChatEventDto.PartUpdated("ses_test", part("prt1", "ses_test", "msg1", "tool", tool = "bash", state = "completed")), flush = false)
        settle()
        flush()

        assertModelEvents("""
            ContentAdded msg1/prt1
            StateChanged Busy
            StateChanged Idle
            ContentUpdated msg1/prt1
        """, modelEvents)
        assertEquals(SessionState.Idle, m.model.state)
    }
}
