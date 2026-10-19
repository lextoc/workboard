package be.alexanderclaes.workboard.project;

import be.alexanderclaes.workboard.auth.AppUser;
import jakarta.persistence.*;

import java.util.Objects;
import java.util.UUID;

@Entity
public class Project {
    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    private UUID id;

    public UUID getId() {
        return id;
    }

    @Column(nullable = false, length = 200)
    private String name;

    public String getName() {
        return name;
    }

    public void setName(String name) {
        if (name == null || name.isBlank()) {
            throw new IllegalArgumentException("Project name cannot be blank.");
        }

        if (name.length() > 200) {
            throw new IllegalArgumentException("Project name cannot exceed 200 characters.");
        }

        this.name = name;
    }

    @ManyToOne(optional = false, fetch = FetchType.LAZY)
    @JoinColumn(name = "owner_id", nullable = false, updatable = false)
    private AppUser owner;

    public void assignOwner(AppUser owner) {
        if (this.owner != null) {
            throw new IllegalStateException("Owner is already assigned.");
        }

        this.owner = Objects.requireNonNull(owner);
    }
}
