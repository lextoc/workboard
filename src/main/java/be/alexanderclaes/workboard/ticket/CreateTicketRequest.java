package be.alexanderclaes.workboard.ticket;

import jakarta.validation.constraints.NotNull;

import java.util.UUID;

public record CreateTicketRequest(
        @NotNull TicketTitle title,
        @NotNull TicketStatus status,
        UUID projectId
) {
}
