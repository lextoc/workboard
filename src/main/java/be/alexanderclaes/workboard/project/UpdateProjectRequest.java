package be.alexanderclaes.workboard.project;

public record UpdateProjectRequest(String name) {
    public UpdateProjectRequest {
        if (name == null || name.isBlank()) {
            throw new IllegalArgumentException("Project name cannot be blank.");
        }

        if (name.length() > 200) {
            throw new IllegalArgumentException(
                    "Project name cannot exceed 200 characters.");
        }
    }
}
