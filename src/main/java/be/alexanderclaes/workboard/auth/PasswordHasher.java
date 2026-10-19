package be.alexanderclaes.workboard.auth;

import com.password4j.Argon2Function;
import com.password4j.Password;
import com.password4j.types.Argon2;
import jakarta.enterprise.context.ApplicationScoped;

@ApplicationScoped
public class PasswordHasher {
    private static final Argon2Function FUNCTION =
            Argon2Function.getInstance(
                    19456,
                    2,
                    1,
                    32,
                    Argon2.ID
            );

    public String hash(String password) {
        return Password.hash(password)
                .addRandomSalt(16)
                .with(FUNCTION)
                .getResult();
    }

    public boolean matches(String password, String encodedHash) {
        return Password.check(password, encodedHash)
                .with(Argon2Function.getInstanceFromHash(encodedHash));
    }
}