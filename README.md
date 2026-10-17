# Workboard

A learning project for a Doing, Next, and Blocked board. Application features will be implemented by the owner.

## Setup

Java 21 or newer is required. The Maven wrapper is included.

The project uses Quarkus 3.40.1 with the same dependencies as the finances project: H2, Hibernate ORM with Panache, JPA security, Hibernate Validator, REST Jackson, reactive routes, ArC, Quarkus JUnit, and REST Assured.

## Development

```sh
./mvnw quarkus:dev
```

The default address is http://localhost:8080. To run alongside another app using that port:

```sh
./mvnw quarkus:dev -Dquarkus.http.port=8081
```

## Build and test

```sh
./mvnw test
./mvnw package
java -jar target/quarkus-app/quarkus-run.jar
```

There are no application classes or tests yet. Read AGENTS.md for the coaching-first agreement.
