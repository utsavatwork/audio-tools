# Deployment

Maintainer notes for how [mp3playground.com](https://mp3playground.com) is hosted and deployed.
Contributors don't need any of this: `npm run dev` is enough to work on the app.

## Pipeline

Every push to `main` deploys automatically through
[.github/workflows/deploy.yml](../.github/workflows/deploy.yml):

1. Install dependencies and build (`npm ci && npm run build`)
2. Sign in to AWS through GitHub OIDC (no stored access keys) by assuming the `github-cicd` IAM role
3. Sync `dist/` to the S3 bucket
4. Invalidate the CloudFront cache so the new version is served right away

A deploy can also be started by hand from the repository's **Actions** tab ("Run workflow").

## Hosting

- **S3** holds the built files. CloudFront reads them through Origin Access Control.
- **CloudFront** serves the site for `mp3playground.com` and `www.mp3playground.com`.
- **DNS** is hosted at Namecheap. Both names point to the CloudFront distribution.

### Certificate

- The ACM certificate covers `mp3playground.com` and `www.mp3playground.com`.
- It **must be in us-east-1 (N. Virginia)**. CloudFront only lists certificates from that
  region, whatever region the rest of the setup is in.
- It uses DNS validation. The validation CNAMEs live in Namecheap and must stay there, or ACM
  can't renew the certificate automatically. In Namecheap, enter the record's Host without the
  `.mp3playground.com` suffix (e.g. `_abc123.www`), because Namecheap appends the domain itself.
- "Allow export" stays disabled. Exportable certificates cost extra, and CloudFront doesn't need one.

### www redirect

A CloudFront Function (`wwwRouting`) runs on **viewer request** and returns a 301 from
`www.mp3playground.com/<path>` to `https://mp3playground.com/<path>`, so there's one canonical domain.

### 404 page

CloudFront **custom error responses** map both **403** and **404** to `/404.html` with a 404
status. The 403 mapping is needed because S3 behind CloudFront returns 403, not 404, for
files that don't exist.

## IAM role for GitHub Actions

The `github-cicd` role is assumed through the `token.actions.githubusercontent.com` OIDC
provider (audience `sts.amazonaws.com`). Its permissions are limited to listing, writing and
deleting objects in the site bucket, and creating invalidations on the distribution.

Its trust policy must allow **both** forms of GitHub's `sub` claim for `main`:

```
repo:<owner>/<repo>:ref:refs/heads/main
repo:<owner>@<owner-id>/<repo>@<repo-id>:ref:refs/heads/main
```

GitHub now sends the second, ID-based form.

### Troubleshooting: deploy fails at "configure AWS credentials"

Symptom: `Could not assume role with OIDC: Not authorized to perform sts:AssumeRoleWithWebIdentity`.

The token's `sub` claim almost certainly doesn't match the trust policy. To see the exact
value AWS rejected, look up `AssumeRoleWithWebIdentity` events in CloudTrail, in the region
the workflow uses:

```bash
aws cloudtrail lookup-events --region ap-south-1 \
  --lookup-attributes AttributeKey=EventName,AttributeValue=AssumeRoleWithWebIdentity \
  --max-results 5
```

The rejected `sub` is in each event's `userIdentity.userName`. Add it to the trust policy's
`token.actions.githubusercontent.com:sub` list.
