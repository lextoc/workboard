package be.alexanderclaes.workboard.ticket;

import be.alexanderclaes.workboard.project.Project;
import jakarta.persistence.*;

import java.time.Instant;
import java.util.Objects;
import java.util.UUID;

@Entity
public class Ticket {
    protected Ticket() {
    }

    public Ticket(TicketTitle title, TicketStatus status, Instant now) {
        setTitle(title);
        changeState(status, false, null, now);
    }

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

    public void setTitle(TicketTitle title) {
        this.title = Objects.requireNonNull(title, "Title is required.").value();
    }

    @Enumerated(EnumType.STRING)
    @Column(nullable = false)
    private TicketStatus status;

    public TicketStatus getStatus() {
        return status;
    }

    private boolean blocked;

    public boolean isBlocked() {
        return blocked;
    }

    @Column(length = 1000)
    private String blockedNote;

    public String getBlockedNote() {
        return blockedNote;
    }

    private Instant completedAt;

    public Instant getCompletedAt() {
        return completedAt;
    }

    @ManyToOne(optional = true)
    @JoinColumn(name = "project_id", nullable = true)
    private Project project;

    public Project getProject() {
        return project;
    }

    public void setProject(Project project) {
        this.project = project;
    }

    public void changeState(
            TicketStatus status,
            boolean blocked,
            BlockedNote blockedNote,
            Instant now
    ) {
        if (status == null) {
            throw new IllegalArgumentException("Status is required.");
        }

        if (blocked && status == TicketStatus.DONE) {
            throw new IllegalArgumentException(
                    "Unblock this ticket before moving it to DONE.");
        }

        if (blocked && blockedNote == null) {
            throw new IllegalArgumentException(
                    "Please provide a reason for blocking this ticket.");
        }

        Objects.requireNonNull(now, "Current time is required.");

        Instant nextCompletedAt = null;

        if (status == TicketStatus.DONE) {
            nextCompletedAt = this.status == TicketStatus.DONE
                    ? this.completedAt
                    : now;
        }

        this.status = status;
        this.blocked = blocked;
        this.blockedNote = blocked ? blockedNote.value() : null;
        this.completedAt = nextCompletedAt;
    }
}
