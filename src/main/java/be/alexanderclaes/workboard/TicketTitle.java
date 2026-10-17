package be.alexanderclaes.workboard;

import com.fasterxml.jackson.annotation.JsonCreator;
import com.fasterxml.jackson.annotation.JsonValue;

public record TicketTitle(@JsonValue String value) {
    public TicketTitle {
        if (value == null || value.isBlank()) {
            throw new IllegalArgumentException("Title cannot be blank.");
        }

        if (value.length() > 200) {
            throw new IllegalArgumentException("Title cannot exceed 200 characters.");
        }
    }

    @JsonCreator(mode = JsonCreator.Mode.DELEGATING)
    public static TicketTitle of(String value) {
        return value == null ? null : new TicketTitle(value);
    }
}
