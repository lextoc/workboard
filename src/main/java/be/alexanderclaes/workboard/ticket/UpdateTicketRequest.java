package be.alexanderclaes.workboard.ticket;

import java.util.UUID;

public record UpdateTicketRequest(
        TicketTitle title,
        TicketStatus status,
        Boolean blocked,
        BlockedNote blockedNote,
        UUID projectId
) {
    public UpdateTicketRequest {
        if (title == null) {
            throw new IllegalArgumentException("Title is required.");
        }

        if (status == null) {
            throw new IllegalArgumentException("Status is required.");
        }

        if (blocked == null) {
            throw new IllegalArgumentException("Blocked is required.");
        }

        if (blocked && status == TicketStatus.DONE) {
            throw new IllegalArgumentException(
                    "Unblock this ticket before moving it to DONE.");
        }

        if (blocked && blockedNote == null) {
            throw new IllegalArgumentException(
                    "Please provide a reason for blocking this ticket.");
        }
    }
}
