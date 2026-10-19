package be.alexanderclaes.workboard.ticket;

import be.alexanderclaes.workboard.auth.AppUser;
import be.alexanderclaes.workboard.auth.CurrentUser;
import be.alexanderclaes.workboard.project.Project;

import io.quarkus.security.Authenticated;
import jakarta.persistence.EntityManager;
import jakarta.inject.Inject;
import jakarta.transaction.Transactional;
import jakarta.ws.rs.*;
import jakarta.ws.rs.core.MediaType;
import jakarta.ws.rs.core.Response;

import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.UUID;
import java.util.Map;

@Path("/api/tickets")
@Produces(MediaType.APPLICATION_JSON)
@Consumes(MediaType.APPLICATION_JSON)
@Authenticated
public class TicketResource {
    @Inject
    EntityManager entityManager;

    @Inject
    CurrentUser currentUser;

    private BadRequestException badRequest(String message) {
        return new BadRequestException(
                Response.status(Response.Status.BAD_REQUEST)
                        .type(MediaType.APPLICATION_JSON_TYPE)
                        .entity(Map.of("message", message))
                        .build()
        );
    }

    @GET
    public List<TicketResponse> getTickets() {
        Instant cutoff = Instant.now().minus(Duration.ofDays(1));

        return entityManager.createQuery("""
            SELECT t FROM Ticket t
            WHERE t.owner.id = :userId
              AND (t.status <> :done OR t.completedAt >= :cutoff)
            ORDER BY t.id ASC
            """, Ticket.class)
                    .setParameter("userId", currentUser.id())
                    .setParameter("done", TicketStatus.DONE)
                    .setParameter("cutoff", cutoff)
                    .getResultList()
                    .stream()
                    .map(TicketResponse::from)
                    .toList();
    }

    @GET
    @Path("/{id}")
    public TicketResponse getTicket(@PathParam("id") UUID id) {
        Ticket ticket = requireOwnedTicket(id);

        return TicketResponse.from(ticket);
    }

    @Transactional
    @POST
    public Response create(CreateTicketRequest request) {
        if (request == null) {
            throw new BadRequestException(
                    Response.status(Response.Status.BAD_REQUEST)
                            .type(MediaType.APPLICATION_JSON_TYPE)
                            .entity(Map.of("message", "Request body is required."))
                            .build()
            );
        }

        Project project = resolveProject(request.projectId());
        Ticket ticket;

        try {
            ticket = new Ticket(
                    request.title(),
                    request.status(),
                    Instant.now()
            );
        } catch (IllegalArgumentException failure) {
            throw badRequest(failure.getMessage());
        }

        ticket.setProject(project);
        ticket.assignOwner(entityManager.getReference(AppUser.class, currentUser.id()));
        entityManager.persist(ticket);

        return Response.status(Response.Status.CREATED)
                .entity(TicketResponse.from(ticket))
                .build();
    }

    @Transactional
    @PUT
    @Path("/{id}")
    public TicketResponse update(
            @PathParam("id") UUID id,
            UpdateTicketRequest request
    ) {
        if (request == null) {
            throw new BadRequestException(
                    Response.status(Response.Status.BAD_REQUEST)
                            .type(MediaType.APPLICATION_JSON_TYPE)
                            .entity(Map.of("message", "Request body is required."))
                            .build()
            );
        }

        Ticket ticket = requireOwnedTicket(id);
        Project project = resolveProject(request.projectId());

        try {
            ticket.changeState(
                    request.status(),
                    request.blocked(),
                    request.blockedNote(),
                    Instant.now()
            );
        } catch (IllegalArgumentException failure) {
            throw badRequest(failure.getMessage());
        }

        ticket.setTitle(request.title());
        ticket.setProject(project);

        return TicketResponse.from(ticket);
    }

    @Transactional
    @DELETE
    @Path("/{id}")
    public Response delete(@PathParam("id") UUID id) {
        Ticket ticket = requireOwnedTicket(id);

        entityManager.remove(ticket);
        return Response.noContent().build();
    }

    private Project resolveProject(UUID projectId) {
        if (projectId == null) {
            return null;
        }

        return entityManager.createQuery("""
            SELECT p FROM Project p
            WHERE p.id = :projectId
              AND p.owner.id = :userId
            """, Project.class)
                .setParameter("projectId", projectId)
                .setParameter("userId", currentUser.id())
                .getResultStream()
                .findFirst()
                .orElseThrow(() -> new NotFoundException("Project not found."));
    }

    private Ticket requireOwnedTicket(UUID ticketId) {
        return entityManager.createQuery("""
            SELECT t FROM Ticket t
            WHERE t.id = :ticketId
              AND t.owner.id = :userId
            """, Ticket.class)
                .setParameter("ticketId", ticketId)
                .setParameter("userId", currentUser.id())
                .getResultStream()
                .findFirst()
                .orElseThrow(() -> new NotFoundException("Ticket not found."));
    }
}
