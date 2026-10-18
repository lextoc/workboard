package be.alexanderclaes.workboard.ticket;

import java.time.Instant;
import java.util.UUID;

public record TicketResponse(
        UUID id,
        String title,
        TicketStatus status,
        boolean blocked,
        String blockedNote,
        Instant completedAt,
        UUID projectId,
        String projectName
) {
    public static TicketResponse from(Ticket ticket) {
        var project = ticket.getProject();

        return new TicketResponse(
                ticket.getId(),
                ticket.getTitle(),
                ticket.getStatus(),
                ticket.isBlocked(),
                ticket.getBlockedNote(),
                ticket.getCompletedAt(),
                project == null ? null : project.getId(),
                project == null ? null : project.getName()
        );
    }
}
