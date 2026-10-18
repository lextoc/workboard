package be.alexanderclaes.workboard.project;

import jakarta.persistence.*;

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
}
