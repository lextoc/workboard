package be.alexanderclaes.workboard.auth;

import java.util.UUID;

public record UserResponse(UUID id, String email) {
    public static UserResponse from(AppUser user) {
        return new UserResponse(user.getId(), user.getEmail());
    }
}