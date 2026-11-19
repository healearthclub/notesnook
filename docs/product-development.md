# Shared product development

The shared requirements live in the sibling Heal Earth Club repository's [product workflow](../../heal-earth-club/docs/vault/operations/shared-product-management.md). [Templates](../../heal-earth-club/docs/vault/operations/product-templates.md), [index](../../heal-earth-club/docs/vault/index.md) and [content/sync decision register](../../heal-earth-club/docs/vault/architecture/content-sync-contract.md) provide the common context. Paths assume the maintained repositories are siblings; see the workflow's client registry for ownership.

## Implement a story

1. Read the stable story ID and its reviewed specification revision before coding.
2. Identify this client's scope, intentional differences and contract blockers.
3. Keep platform implementation details in this repository; change shared behavior in the vault through review.
4. Link the story/revision in issues and PRs. Record actual source/build/test evidence.
5. Update this client's delivery record in the shared vault independently of other clients.
6. Validate/export shared records and refresh the multi-client graph from the web repository.

Follow this repository's existing build/test instructions for implementation checks. Do not replace them with documentation checks. Run the actual acceptance criteria; record failed, partial and unexecuted coverage explicitly. Unknown is not missing, Implemented is not Passed, and a local build is not Production.

Use `.github/ISSUE_TEMPLATE/shared-product-task.yml` for work tracking. Templates are local until committed/pushed through the normal workflow; remote issues or a project board are not created by installing them.
