package be.alexanderclaes.workboard;

import jakarta.annotation.Priority;
import jakarta.enterprise.inject.Alternative;
import jakarta.inject.Singleton;

import java.time.Clock;
import java.time.Instant;
import java.time.ZoneId;
import java.time.ZoneOffset;

@Alternative
@Priority(1)
@Singleton
public class MutableClock extends Clock {
    private volatile Instant fixed;

    public void set(Instant instant) {
        fixed = instant;
    }

    @Override
    public ZoneId getZone() {
        return ZoneOffset.UTC;
    }

    @Override
    public Clock withZone(ZoneId zone) {
        return Clock.fixed(instant(), zone);
    }

    @Override
    public Instant instant() {
        Instant value = fixed;
        return value == null ? Instant.now() : value;
    }
}
