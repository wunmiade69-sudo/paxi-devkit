#!/usr/bin/env python3
"""Offline JSON Schema validator for PAXI SBOMs. Remote $ref values are blocked."""
import json
import os
import sys
from pathlib import Path

MAX_DOCUMENT = 50 * 1024 * 1024
MAX_SCHEMA = 10 * 1024 * 1024
MAX_ERRORS = 200


def fail(status, message, **extra):
    print(json.dumps({"status": status, "valid": False, "errors": [], "message": message, **extra}))
    raise SystemExit(0)


def regular_file(raw, label, maximum):
    path = Path(os.path.abspath(Path(raw).expanduser()))
    info = path.lstat()
    if path.is_symlink() or not path.is_file():
        raise ValueError(f"{label} must be a regular non-symlink file")
    if info.st_size > maximum:
        raise ValueError(f"{label} exceeds the {maximum}-byte limit")
    return path


def reject_external_refs(value, where="$", depth=0):
    if depth > 100:
        raise ValueError("Schema nesting exceeds the safety limit")
    if isinstance(value, dict):
        ref = value.get("$ref")
        if ref is not None and (not isinstance(ref, str) or not ref.startswith("#/")):
            raise ValueError(f"External or non-local JSON Schema reference is blocked at {where}")
        for key, child in value.items():
            reject_external_refs(child, f"{where}/{key}", depth + 1)
    elif isinstance(value, list):
        for index, child in enumerate(value):
            reject_external_refs(child, f"{where}/{index}", depth + 1)


def main():
    if len(sys.argv) != 3:
        fail("invalid-arguments", "Usage: validate-json-schema.py <document.json> <schema.json>")
    try:
        document_path = regular_file(sys.argv[1], "SBOM", MAX_DOCUMENT)
        schema_path = regular_file(sys.argv[2], "JSON Schema", MAX_SCHEMA)
        document = json.loads(document_path.read_text(encoding="utf-8"))
        schema = json.loads(schema_path.read_text(encoding="utf-8"))
        reject_external_refs(schema)
        try:
            import jsonschema
        except ImportError:
            fail("tool-missing", "Python package jsonschema is not installed. Install it in a virtual environment with: python -m pip install jsonschema")
        validator_class = jsonschema.validators.validator_for(schema)
        validator_class.check_schema(schema)
        validator = validator_class(schema)
        errors = []
        for error in validator.iter_errors(document):
            if len(errors) >= MAX_ERRORS:
                break
            location = "/" + "/".join(str(part).replace("~", "~0").replace("/", "~1") for part in error.absolute_path)
            errors.append({"path": location, "keyword": error.validator, "message": str(error.message)[:500]})
        schema_hash = __import__("hashlib").sha256(schema_path.read_bytes()).hexdigest()
        document_hash = __import__("hashlib").sha256(document_path.read_bytes()).hexdigest()
        print(json.dumps({
            "status": "valid" if not errors else "invalid",
            "valid": not errors,
            "validator": jsonschema.__version__ if hasattr(jsonschema, "__version__") else "installed",
            "errors": errors,
            "truncated": len(errors) == MAX_ERRORS,
            "schema": {"path": str(schema_path), "sha256": schema_hash},
            "document": {"path": str(document_path), "sha256": document_hash},
            "externalReferences": "blocked"
        }))
    except FileNotFoundError as exc:
        fail("file-not-found", f"Required file was not found: {exc.filename}")
    except Exception as exc:
        fail("error", str(exc)[:800])


if __name__ == "__main__":
    main()
