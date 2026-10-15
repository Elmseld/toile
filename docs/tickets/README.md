# Tickets

One file per ticket: `NNNN-short-title.md`. Run `/ship NNNN` to have the agents take it all the way to a PR.

Front matter:

```yaml
---
id: 0001
title: Short title
status: todo        # todo | in-progress | in-review | done
type: feature       # feature | bug | chore
---
```

Write the **what** and the **why**, and make the acceptance criteria testable. The planning agent
decides the **how**.
