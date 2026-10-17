package be.alexanderclaes.workboard;

import jakarta.persistence.EntityManager;
import jakarta.validation.constraints.NotNull;
import jakarta.inject.Inject;
import jakarta.transaction.Transactional;
import jakarta.validation.Valid;
import jakarta.ws.rs.*;
import jakarta.ws.rs.core.MediaType;
import jakarta.ws.rs.core.Response;

import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.UUID;

@Path("/api/tickets")
@Produces(MediaType.APPLICATION_JSON)
@Consumes(MediaType.APPLICATION_JSON)
public class TicketResource {
    @Inject
    EntityManager entityManager;

    @GET
    public List<Ticket> getTickets() {
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

    @GET
    @Path("/{id}")
    public Ticket getTicket(@PathParam("id") UUID id) {
        Ticket ticket = entityManager.find(Ticket.class, id);

        if (ticket == null) {
            throw new NotFoundException("Ticket not found.");
        }

        return ticket;
    }

    @Transactional
    @POST
    public Response create(@Valid @NotNull CreateTicketRequest request) {
        Ticket ticket = new Ticket();

        ticket.setTitle(request.title().value());
        ticket.setStatus(request.status());
        ticket.setBlocked(false);
        ticket.setBlockedNote(null);
        ticket.setCompletedAt(request.status() == TicketStatus.DONE ? Instant.now() : null);

        entityManager.persist(ticket);

        return Response.status(Response.Status.CREATED).entity(ticket).build();
    }

    @Transactional
    @PUT
    @Path("/{id}")
    public Ticket update(@PathParam("id") UUID id, @Valid @NotNull UpdateTicketRequest request) {
        Ticket ticket = entityManager.find(Ticket.class, id);

        if (ticket == null) {
            throw new NotFoundException("Ticket not found.");
        }

        if (request.blocked() && request.status() == TicketStatus.DONE) {
            throw new BadRequestException(
                    "Unblock this ticket before moving it to DONE.");
        }

        if (request.blocked() && (request.blockedNote() == null || request.blockedNote().value().isBlank())) {
            throw new BadRequestException(
                    "Please provide a reason for blocking this ticket.");
        }

        TicketStatus previousStatus = ticket.getStatus();

        ticket.setTitle(request.title().value());
        ticket.setStatus(request.status());
        ticket.setBlocked(request.blocked());
        ticket.setBlockedNote(request.blocked() ? request.blockedNote().value() : null);

        if (request.status() == TicketStatus.DONE) {
            if (previousStatus != TicketStatus.DONE) {
                ticket.setCompletedAt(Instant.now());
            }
        } else {
            ticket.setCompletedAt(null);
        }

        return ticket;
    }

    @Transactional
    @DELETE
    @Path("/{id}")
    public Response delete(@PathParam("id") UUID id) {
        Ticket ticket = entityManager.find(Ticket.class, id);

        if (ticket == null) {
            throw new NotFoundException("Ticket not found.");
        }

        entityManager.remove(ticket);
        return Response.noContent().build();
    }
}
