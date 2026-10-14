---
id: 0004
title: Måttprofiler
status: todo
type: feature
---

## Bakgrund
Alla mönster räknas fram ur mått. Användaren behöver kunna spara mått för sig själv och andra.

## Önskat beteende
Under "Mått" kan användaren skapa, döpa, redigera och ta bort måttprofiler. Varje mått har en
förklaring av hur det tas.

## Acceptanskriterier
- [ ] CRUD för måttprofiler, scopat till inloggad användare. Andras profiler går inte att se eller ändra.
- [ ] En fast lista med mått som räcker för livstycke, kjol och ärm, minst: bystvidd, midjevidd, höftvidd, halsvidd, axelbredd, ryggbredd, bröstbredd, ryggängd, framlängd, bysthöjd, bystavstånd, höfthöjd, kjollängd, armlängd, överarmsvidd, handledsvidd, längd.
- [ ] Varje mått har en svensk etikett och en kort hjälptext om hur det tas.
- [ ] Mått matas in i cm med en decimal och lagras i mm. Orimliga värden (negativa, noll, över 300 cm) avvisas.
- [ ] Ofullständiga profiler går att spara. Det syns vilka mått som saknas.
- [ ] Fungerar med touch på surfplatta (stora fält, numeriskt tangentbord).

## Utanför scope
- Bilder och illustrationer till måtten (text räcker nu).
- Egna, användardefinierade mått.

## Anteckningar
Måttnycklarna (t.ex. `waist`) är samma namn som formlerna i motorn refererar till.
Definiera listan på ett ställe som både Elixir och motorns grundmönster kan lita på.
