package be.alexanderclaes.workboard;

import jakarta.persistence.*;

import java.time.Instant;
import java.util.UUID;

@Entity
public class Ticket {
    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    private UUID id;

    public UUID getId() {
        return id;
    }

    @Column(nullable = false, length = 200)
    private String title;

    public String getTitle() {
        return title;
    }

    public void setTitle(String title) {
        this.title = title;
    }

    @Enumerated(EnumType.STRING)
    @Column(nullable = false)
    private TicketStatus status;

    public TicketStatus getStatus() {
        return status;
    }

    public void setStatus(TicketStatus status) {
        this.status = status;
    }

    private boolean blocked;

    public boolean isBlocked() {
        return blocked;
    }

    public void setBlocked(boolean blocked) {
        this.blocked = blocked;
    }

    @Column(length = 1000)
    private String blockedNote;

    public String getBlockedNote() {
        return blockedNote;
    }

    public void setBlockedNote(String blockedNote) {
        this.blockedNote = blockedNote;
    }

    private Instant completedAt;

    public void setCompletedAt(Instant completedAt) {
        this.completedAt = completedAt;
    }

    public Instant getCompletedAt() {
        return completedAt;
    }
}
