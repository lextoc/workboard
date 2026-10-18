package be.alexanderclaes.workboard.ticket;

import jakarta.validation.constraints.NotNull;

import java.util.UUID;

public record UpdateTicketRequest(
        @NotNull TicketTitle title,
        @NotNull TicketStatus status,
        @NotNull Boolean blocked,
        BlockedNote blockedNote,
        UUID projectId
) {

}
