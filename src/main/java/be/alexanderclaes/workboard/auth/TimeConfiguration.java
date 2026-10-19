package be.alexanderclaes.workboard.auth;

import jakarta.enterprise.inject.Produces;
import jakarta.inject.Singleton;

import java.time.Clock;

@Singleton
public class TimeConfiguration {
    @Produces
    @Singleton
    public Clock clock() {
        return Clock.systemUTC();
    }
}