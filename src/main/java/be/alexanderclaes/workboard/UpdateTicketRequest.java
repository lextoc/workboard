package be.alexanderclaes.workboard;

import jakarta.validation.constraints.NotNull;

public record UpdateTicketRequest(
        @NotNull TicketTitle title,
        @NotNull TicketStatus status,
        @NotNull Boolean blocked,
        BlockedNote blockedNote
) {

}
