package be.alexanderclaes.workboard.project;

import java.util.UUID;

public record ProjectResponse(UUID id, String name) {
    public static ProjectResponse from (Project project) {
        return new ProjectResponse(project.getId(), project.getName());
    }
}
