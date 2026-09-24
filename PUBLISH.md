# Publish the preview (Rare Friends: Impostor Protocol)

This folder is a ready-to-push repository:

| Path | What it is |
| --- | --- |
| `docs/` | the built static preview — this is what GitHub Pages serves |
| `game/` | the game source (`index.tsx`, `src/`, `tests/`, `game.json`, `style.css`, `README.md`, `DESIGN.md`) |
| `README.md` | the in-repo game README (setup, rules, checks) |
| `SUBMISSION.md` | the vibeathon submission text in the repo's expected format |
| `publish.sh` | commits everything and pushes to your repository |

The static preview in `docs/` has already been verified: served over HTTP and
loaded in a real browser, every asset resolves and the SDK wallet/ownership gate
renders with no page errors.

## Steps

1. Create an empty **public** repository on GitHub, e.g. `impostor-protocol`.
2. Set your git identity once, if you have not already:

   ```sh
   git config --global user.name  "Your Name"
   git config --global user.email "you@example.com"
   ```

3. From this folder, run:

   ```sh
   sh publish.sh git@github.com:<you>/impostor-protocol.git
   ```

4. On GitHub: **Settings → Pages → Source: Deploy from a branch →
   Branch: `main` / Folder: `/docs`**, then wait for the first deploy.

5. Your preview URL is `https://<you>.github.io/<repo>/`.

## Then: submit to the vibeathon

The submission is a pull request against `spokesz/rarefriends-vibeathon` that
adds `submissions/impostor-protocol/README.md`. `SUBMISSION.md` is already written
in that repository's format, with the builder handle and preview URL already filled
in. The branch `submission/impostor-protocol` is pushed to the fork.

```sh
# fork spokesz/rarefriends-vibeathon on GitHub, then:
git clone https://github.com/<you>/rarefriends-vibeathon.git
cd rarefriends-vibeathon
mkdir -p submissions/impostor-protocol
cp /path/to/SUBMISSION.md submissions/impostor-protocol/README.md
git checkout -b submissions/impostor-protocol
git add submissions/impostor-protocol/README.md
git commit -m "Submission: Rare Friends: Impostor Protocol"
git push -u origin submissions/impostor-protocol
```

Open the pull request against `spokesz:main` and paste the same text as the PR
description. Requirements the submission already covers: project name, builder,
category, one-sentence summary, source repo, public preview link, wallet/network
requirements, controls and rules, RF costs with outcome probabilities and
consumable rules, checks with real results, known limitations and asset credits.

**Before submitting:** play a round yourself with your own wallet and Friend, on
both desktop and phone. Then open the PR with
`gh pr create --repo spokesz/rarefriends-vibeathon --head barthazian:submission/impostor-protocol`.
