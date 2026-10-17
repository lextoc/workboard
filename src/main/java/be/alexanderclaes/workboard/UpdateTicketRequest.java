package be.alexanderclaes.workboard;

import jakarta.validation.constraints.Size;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.NotBlank;

public record UpdateTicketRequest(
        @NotNull TicketTitle title,
        @NotNull TicketStatus status,
        @NotNull Boolean blocked,
        BlockedNote blockedNote
) {

}
