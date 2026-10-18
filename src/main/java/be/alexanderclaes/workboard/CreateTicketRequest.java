package be.alexanderclaes.workboard;

import jakarta.validation.constraints.NotNull;

public record CreateTicketRequest(
        @NotNull TicketTitle title,
        @NotNull TicketStatus status
) {
}
