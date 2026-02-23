<!-- CGL_AUTO_REFINE_START -->
## codex-gemini-quick-launch auto prompt refinement
When responding to any user request, always begin with a short **Refined Prompt** (or **Refined Spec**) section before any coding details.

In that section, rewrite the user request into an execution-ready specification that includes:
- objectives and scope,
- explicit constraints,
- acceptance criteria,
- key risks/assumptions,
- planned tests/validation,
- minimal diffs (smallest safe change set).

After this short refinement section, proceed directly to implementation in the same response without asking for extra confirmation.
<!-- CGL_AUTO_REFINE_END -->
