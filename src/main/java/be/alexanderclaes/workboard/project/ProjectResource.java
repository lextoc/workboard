package be.alexanderclaes.workboard.project;

import jakarta.inject.Inject;
import jakarta.persistence.EntityManager;
import jakarta.transaction.Transactional;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotNull;
import jakarta.ws.rs.*;
import jakarta.ws.rs.core.MediaType;
import jakarta.ws.rs.core.Response;

import java.util.List;
import java.util.Map;
import java.util.UUID;

@Path("/api/projects")
@Produces(MediaType.APPLICATION_JSON)
@Consumes(MediaType.APPLICATION_JSON)
public class ProjectResource {
    @Inject
    EntityManager entityManager;


    @GET
    public List<ProjectResponse> getProjects() {
        return entityManager.createQuery(
                        "SELECT p FROM Project p ORDER BY p.id ASC",
                        Project.class
                )
                .getResultList()
                .stream()
                .map(ProjectResponse::from)
                .toList();
    }

    @POST
    @Transactional
    public Response create(@Valid @NotNull CreateProjectRequest request) {
        Project project = new Project();
        project.setName(request.name());

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
            @Valid @NotNull UpdateProjectRequest request
    ) {
        Project project = entityManager.find(Project.class, id);

        if (project == null) {
            throw new NotFoundException(
                    Response.status(Response.Status.NOT_FOUND)
                            .type(MediaType.APPLICATION_JSON_TYPE)
                            .entity(Map.of("message", "Project not found."))
                            .build()
            );
        }

        project.setName(request.name());

        return ProjectResponse.from(project);
    }
}
