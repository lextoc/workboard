package be.alexanderclaes.workboard.project;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

public record CreateProjectRequest(
        @NotBlank(message = "Project name cannot be blank.")
        @Size(max = 200, message = "Project name cannot exceed 200 characters.")
        String name
) {
}
