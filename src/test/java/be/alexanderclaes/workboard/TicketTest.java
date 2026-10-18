package be.alexanderclaes.workboard;

import be.alexanderclaes.workboard.ticket.BlockedNote;
import be.alexanderclaes.workboard.ticket.Ticket;
import be.alexanderclaes.workboard.ticket.TicketStatus;
import be.alexanderclaes.workboard.ticket.TicketTitle;
import org.junit.jupiter.api.Test;

import java.time.Instant;

import static org.junit.jupiter.api.Assertions.assertAll;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;

class TicketTest {
    private static final Instant CREATED_AT = Instant.parse("2026-10-18T10:00:00Z");
    private static final Instant COMPLETED_AT = CREATED_AT.plusSeconds(60);
    private static final Instant LATER = COMPLETED_AT.plusSeconds(60);

    @Test
    void constructsValidUnblockedTicketsInEveryStatus() {
        for (TicketStatus status : TicketStatus.values()) {
            Ticket ticket = new Ticket(new TicketTitle("Original title"), status, CREATED_AT);

            assertEquals("Original title", ticket.getTitle());
            assertLifecycle(ticket, status, false, null, status == TicketStatus.DONE ? CREATED_AT : null);
        }
    }

    @Test
    void rejectsMissingConstructionValues() {
        assertThrows(NullPointerException.class,
                () -> new Ticket(null, TicketStatus.TODO, CREATED_AT));
        assertThrows(IllegalArgumentException.class,
                () -> new Ticket(new TicketTitle("Original title"), null, CREATED_AT));
        assertThrows(NullPointerException.class,
                () -> new Ticket(new TicketTitle("Original title"), TicketStatus.TODO, null));
    }

    @Test
    void rejectsNullTitleWithoutChangingExistingTitle() {
        Ticket ticket = new Ticket(new TicketTitle("Original title"), TicketStatus.TODO, CREATED_AT);

        assertThrows(NullPointerException.class, () -> ticket.setTitle(null));

        assertEquals("Original title", ticket.getTitle());
    }

    @Test
    void recordsPreservesClearsAndRecordsCompletionTimeAgain() {
        Ticket ticket = new Ticket(new TicketTitle("Original title"), TicketStatus.TODO, CREATED_AT);

        ticket.changeState(TicketStatus.DONE, false, null, COMPLETED_AT);
        assertLifecycle(ticket, TicketStatus.DONE, false, null, COMPLETED_AT);

        ticket.setTitle(new TicketTitle("Edited title"));
        ticket.changeState(TicketStatus.DONE, false, null, LATER);
        assertEquals("Edited title", ticket.getTitle());
        assertLifecycle(ticket, TicketStatus.DONE, false, null, COMPLETED_AT);

        ticket.changeState(TicketStatus.DOING, false, null, LATER);
        assertLifecycle(ticket, TicketStatus.DOING, false, null, null);

        ticket.changeState(TicketStatus.DONE, false, null, LATER);
        assertLifecycle(ticket, TicketStatus.DONE, false, null, LATER);
    }

    @Test
    void preservesAndEditsBlockingReasonAcrossOpenStatusesAndClearsItOnUnblocking() {
        Ticket ticket = new Ticket(new TicketTitle("Original title"), TicketStatus.TODO, CREATED_AT);
        BlockedNote original = new BlockedNote("Waiting for access");
        BlockedNote revised = new BlockedNote("Waiting for review");

        ticket.changeState(TicketStatus.TODO, true, original, CREATED_AT);
        assertLifecycle(ticket, TicketStatus.TODO, true, original.value(), null);

        ticket.changeState(TicketStatus.DOING, true, original, COMPLETED_AT);
        assertLifecycle(ticket, TicketStatus.DOING, true, original.value(), null);

        ticket.changeState(TicketStatus.DOING, true, revised, LATER);
        assertLifecycle(ticket, TicketStatus.DOING, true, revised.value(), null);

        ticket.changeState(TicketStatus.TODO, false, revised, LATER);
        assertLifecycle(ticket, TicketStatus.TODO, false, null, null);
    }

    @Test
    void canUnblockAndCompleteInOneOperation() {
        Ticket ticket = new Ticket(new TicketTitle("Original title"), TicketStatus.DOING, CREATED_AT);
        BlockedNote note = new BlockedNote("Waiting for review");
        ticket.changeState(TicketStatus.DOING, true, note, CREATED_AT);

        ticket.changeState(TicketStatus.DONE, false, note, COMPLETED_AT);

        assertLifecycle(ticket, TicketStatus.DONE, false, null, COMPLETED_AT);
    }

    @Test
    void rejectedChangesPreserveExistingBlockingState() {
        Ticket ticket = new Ticket(new TicketTitle("Original title"), TicketStatus.DOING, CREATED_AT);
        BlockedNote note = new BlockedNote("Waiting for access");
        ticket.changeState(TicketStatus.DOING, true, note, CREATED_AT);

        assertThrows(IllegalArgumentException.class,
                () -> ticket.changeState(null, false, null, LATER));
        assertLifecycle(ticket, TicketStatus.DOING, true, note.value(), null);

        assertThrows(IllegalArgumentException.class,
                () -> ticket.changeState(TicketStatus.DONE, true, note, LATER));
        assertLifecycle(ticket, TicketStatus.DOING, true, note.value(), null);

        assertThrows(IllegalArgumentException.class,
                () -> ticket.changeState(TicketStatus.TODO, true, null, LATER));
        assertLifecycle(ticket, TicketStatus.DOING, true, note.value(), null);

        assertThrows(NullPointerException.class,
                () -> ticket.changeState(TicketStatus.DONE, false, null, null));
        assertLifecycle(ticket, TicketStatus.DOING, true, note.value(), null);
    }

    @Test
    void rejectedBlockingPreservesExistingCompletionTime() {
        Ticket ticket = new Ticket(new TicketTitle("Original title"), TicketStatus.DONE, COMPLETED_AT);

        assertThrows(IllegalArgumentException.class,
                () -> ticket.changeState(TicketStatus.DONE, true, new BlockedNote("New blocker"), LATER));

        assertLifecycle(ticket, TicketStatus.DONE, false, null, COMPLETED_AT);
    }

    private void assertLifecycle(
            Ticket ticket,
            TicketStatus status,
            boolean blocked,
            String note,
            Instant completedAt
    ) {
        assertAll(
                () -> assertEquals(status, ticket.getStatus()),
                () -> assertEquals(blocked, ticket.isBlocked()),
                () -> assertEquals(note, ticket.getBlockedNote()),
                () -> assertEquals(completedAt, ticket.getCompletedAt())
        );
    }
}
