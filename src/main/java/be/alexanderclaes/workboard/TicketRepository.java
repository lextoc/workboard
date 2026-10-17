package be.alexanderclaes.workboard;

import jakarta.enterprise.context.ApplicationScoped;
import jakarta.inject.Inject;
import jakarta.persistence.EntityManager;

import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.UUID;

@ApplicationScoped
public class TicketRepository {
    @Inject
    EntityManager entityManager;

    public Ticket findById(UUID id) {
        return entityManager.find(Ticket.class, id);
    }

    public void persist(Ticket ticket) {
        entityManager.persist(ticket);
    }

    public List<Ticket> findAll() {
        Instant cutoff = Instant.now().minus(Duration.ofMinutes(5));

        return entityManager.createQuery(
                """
                    SELECT t FROM Ticket t
                    WHERE t.status <> :done OR t.completedAt >= :cutoff
                    ORDER BY t.id ASC
                """,
                Ticket.class
            )
                .setParameter("done", TicketStatus.DONE)
                .setParameter("cutoff", cutoff)
                .getResultList();
    }

    public boolean deleteById(UUID id) {
        Ticket ticket = entityManager.find(Ticket.class, id);
        if (ticket != null) {
            entityManager.remove(ticket);
            return true;
        }
        return false;
    }
}
