---
layout: default
title: Installation and Operations
nav_order: 3
has_children: true
---

# Installation And Operations

Choose one application installation path:

- [Docker Compose](../DOCKER.md): containerized Web/API with optional data services.
- [Host and PM2](../QUICK-DEPLOYMENT.md): run the application on a managed Node.js host.

Then use [configuration](../CONFIGURATION.md) for server settings and
[operations and troubleshooting](../OPERATIONS.md) for maintenance, upgrades,
backups and recovery. Complete the [administrator setup](../ADMIN-GUIDE.md)
before inviting users.

Start with the simple topology. Add capacity only when needed using
[manual Docker capacity](../DOCKER-CAPACITY.md) or the
[PM2 capacity reference](../SINGLE-HOST-HIGH-CONCURRENCY.md), according to the
installation method you chose.
