package be.alexanderclaes.workboard.ticket;

import java.util.UUID;

public record CreateTicketRequest(
        TicketTitle title,
        TicketStatus status,
        UUID projectId
) {
    public CreateTicketRequest {
        if (title == null) {
            throw new IllegalArgumentException("Title is required.");
        }

        if (status == null) {
            throw new IllegalArgumentException("Status is required.");
        }
    }
}
