package be.alexanderclaes.workboard;

import jakarta.validation.constraints.Size;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.NotBlank;

public record UpdateTicketRequest(
        @NotBlank @Size(max = 200) String title,
        @NotNull TicketStatus status,
        @NotNull Boolean blocked,
        @Size(max = 1000) String blockedNote
) {

}
