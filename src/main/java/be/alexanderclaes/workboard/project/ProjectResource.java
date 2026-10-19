package be.alexanderclaes.workboard.project;

import be.alexanderclaes.workboard.auth.AppUser;
import be.alexanderclaes.workboard.auth.CurrentUser;
import io.quarkus.security.Authenticated;
import jakarta.inject.Inject;
import jakarta.persistence.EntityManager;
import jakarta.transaction.Transactional;
import jakarta.ws.rs.*;
import jakarta.ws.rs.core.MediaType;
import jakarta.ws.rs.core.Response;

import java.util.List;
import java.util.Map;
import java.util.UUID;

@Path("/api/projects")
@Produces(MediaType.APPLICATION_JSON)
@Consumes(MediaType.APPLICATION_JSON)
@Authenticated
public class ProjectResource {
    @Inject
    EntityManager entityManager;

    @Inject
    CurrentUser currentUser;

    @GET
    public List<ProjectResponse> getProjects() {
        return entityManager.createQuery("""
            SELECT p FROM Project p
            WHERE p.owner.id = :userId
            ORDER BY p.id ASC
            """, Project.class)
                    .setParameter("userId", currentUser.id())
                    .getResultList()
                    .stream()
                    .map(ProjectResponse::from)
                    .toList();
    }

    @POST
    @Transactional
    public Response create(CreateProjectRequest request) {
        if (request == null) {
            throw new BadRequestException(
                    Response.status(Response.Status.BAD_REQUEST)
                            .type(MediaType.APPLICATION_JSON_TYPE)
                            .entity(Map.of("message", "Request body is required."))
                            .build()
            );
        }

        Project project = new Project();
        project.setName(request.name());
        project.assignOwner(
                entityManager.getReference(AppUser.class, currentUser.id())
        );

        entityManager.persist(project);

        return Response.status(Response.Status.CREATED)
                .entity(ProjectResponse.from(project))
                .build();
    }

    @PUT
    @Path("/{id}")
    @Transactional
    public ProjectResponse update(
            @PathParam("id") UUID id,
            UpdateProjectRequest request
    ) {
        if (request == null) {
            throw new BadRequestException(
                    Response.status(Response.Status.BAD_REQUEST)
                            .type(MediaType.APPLICATION_JSON_TYPE)
                            .entity(Map.of("message", "Request body is required."))
                            .build()
            );
        }

        Project project = requireOwnedProject(id);

        project.setName(request.name());

        return ProjectResponse.from(project);
    }

    @Transactional
    @DELETE
    @Path("/{id}")
    public Response delete(@PathParam("id") UUID id) {
        Project project = requireOwnedProject(id);

        long assignedTickets = entityManager.createQuery(
                "SELECT COUNT(t) FROM Ticket t WHERE t.project.id = :projectId",
                Long.class
        )
                .setParameter("projectId", id)
                .getSingleResult();

        if (assignedTickets > 0) {
            return Response.status(Response.Status.CONFLICT)
                    .type(MediaType.APPLICATION_JSON_TYPE)
                    .entity(Map.of("message", "Unassign this project's tickets before deleting it."))
                    .build();
        }

        entityManager.remove(project);

        return Response.noContent().build();
    }

    private Project requireOwnedProject(UUID projectId) {
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
}
