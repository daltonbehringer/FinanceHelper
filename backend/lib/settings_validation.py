"""Shared validation for saved preferences and optional estimate inputs."""
import re

from fastapi import HTTPException

MAX_CENTS = 9_007_199_254_740_991  # Largest integer represented exactly by the UI.


def validate_money(value):
    if type(value) is not int or not 0 <= value <= MAX_CENTS:
        raise HTTPException(status_code=422, detail="Amounts must be nonnegative integer cents within the supported range")


def validate_location(zip_code, household_size):
    if zip_code and not re.fullmatch(r"[0-9]{5}(?:-[0-9]{4})?", zip_code):
        raise HTTPException(status_code=422, detail="Enter a valid US ZIP code (12345 or 12345-6789)")
    if household_size is not None and (type(household_size) is not int or not 1 <= household_size <= MAX_CENTS):
        raise HTTPException(status_code=422, detail="Household size must be a whole number of at least 1")
