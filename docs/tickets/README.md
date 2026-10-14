# Tickets

En fil per ticket: `NNNN-kort-titel.md`. Kör `/ship NNNN` för att låta agenterna ta den hela vägen till en PR.

Front matter:

```yaml
---
id: 0001
title: Kort titel
status: todo        # todo | in-progress | in-review | done
type: feature       # feature | bug | chore
---
```

Skriv **vad** och **varför**, och gör acceptanskriterierna testbara. Planeringsagenten
bestämmer **hur**.
