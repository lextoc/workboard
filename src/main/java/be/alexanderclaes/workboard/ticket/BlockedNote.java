package be.alexanderclaes.workboard.ticket;

import com.fasterxml.jackson.annotation.JsonCreator;
import com.fasterxml.jackson.annotation.JsonValue;

public record BlockedNote(@JsonValue String value) {
    public BlockedNote {
        if (value == null || value.isBlank()) {
            throw new IllegalArgumentException("Blocked note cannot be blank.");
        }

        if (value.length() > 1000) {
            throw new IllegalArgumentException("Blocked note cannot exceed 1000 characters.");
        }
    }

    @JsonCreator(mode = JsonCreator.Mode.DELEGATING)
    public static BlockedNote of(String value) {
        return value == null ? null : new BlockedNote(value);
    }
}
