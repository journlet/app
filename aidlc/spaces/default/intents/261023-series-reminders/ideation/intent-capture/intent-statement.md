# Intent Statement: Reminders on Repeating Items

## Problem Statement

A reminder cannot be set on a repeating item that already exists: adding a reminder only applies it to the one entry it was added on. [desc]

People need to choose, when adding a reminder to an entry of a repeating item, whether it is for that entry only or for the whole repeating item. [Q1]

The same choice is needed when a reminder on a repeating item is later changed or removed. [Q3]

## Target Customer

The people affected are the person reporting the problem and other people who use Journlet. [Q4]

They benefit by setting a reminder once for a repeating item, either from the entry or from the repeating item's own settings, instead of adding it entry by entry. [Q2] [Q5]

## Success Metrics

| Metric | Pass criterion | Source |
|--------|----------------|--------|
| Series coverage | After one reminder is added to a repeating item for the whole repeating item, 100% of the covered occurrences show that reminder without it being added again. | [Q5] [Q7] |
| Notification | Each covered occurrence notifies at the set time. | [Q5] |
| Coverage boundary | "The whole repeating item" covers the chosen occurrence and every future one; 0 past occurrences are changed. | [Q7] |
| Individual overrides | An entry given its own, different reminder keeps that reminder after a series reminder is added. | [Q5] |
| Choice offered | Adding, changing or removing a reminder on an entry of a repeating item asks "this entry only" or "the whole repeating item" every time. | [Q1] [Q3] |

## Initiative Trigger

The trigger is the reported problem: adding a reminder to an existing repeating item only sets it on that single entry. [desc]

## Initial Scope Signal

- Workflow-selected scope: `poc`, a short run. [scope]
- User-confirmed product boundary: only reminders on repeating items, run as the short workflow. [Q6]
- Ways to set a series reminder that are in the boundary: from the entry, and from the repeating item's own settings. [Q2]
- Changing and removing a reminder on a repeating item are in the boundary, with the same "this entry only or whole repeating item" choice. [Q3]

## Assumptions & Open Questions

None.
