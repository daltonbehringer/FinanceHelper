"""Service layer (Phase 1, WS1). All writes route through these modules.

Every write function follows the same contract: validate -> mutate the state
table -> insert an event row, all inside ONE transaction (commit or roll back
together). Functions take an EventContext describing who/what caused the write.
"""
