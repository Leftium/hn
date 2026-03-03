# HN Reader

Try it out:

- [hn.leftium.com](https://hn.leftium.com) (all frontpage stories, in chronological order)
- [hn.leftium.com/top](https://hn.leftium.com/top) (if you prefer HN's default order)

<img width="706" height="529" alt="image" src="https://github.com/user-attachments/assets/792f56f1-4c60-4968-88f0-59ccc81bd92d" />

## Major Features/Benefits

### <kbd>**Page Down**</kbd> for mobile

- Simple tap of gray index region scrolls item to very top.
- Easier/more convenient than (over) scrolling.

### Visualize new items since last visit

- New stories since last visit marked with orange item number and accent.
- Manage what date is used in settings.

### Highlight interesting items

- Vote/comment icons turn orange when the count passes 50.
- After 100, the number also turns orange.

### Extra info

- Full URL
- Highlight (probable) [_re-upped_](https://hw.leftium.com/#/item/10537417) items
- Time taken to reach front page
- Domain and vote count for [dead] items

### Information dense, yet still readable

- Only two lines per story: title + details
- "points" and "comments" compressed into icons
- times/durations abbreviated
- removed submitter's id (can view on click)
- full URL, with domain highlighted

## Problems fixed/improvements from previous version ([HckrWeb](https://hw.leftium.com/))

- Works without JS; progressive enhancement
- More stories fit on screen.
  - About 6 extra stories on desktop. (16 to 22 stories)
  - About 4 extra stories on mobile (9 to 13 stories on Pixel 9a)
- Last visit
  - Much easier to see if any story was posted before or after last visit.
  - Can set the date by selecting from previous visits or datepicker.
  - Smart detection of new visits (via a "rolling" session)
- Bug where "More" link could skip past the previous date
- In addition to [HckrNews](https://hckrnews.com/) feed, supports all lists/feeds offered by HN.

---

<details>
<summary><b>This project uses <a href="https://svelte.dev/docs/kit">SvelteKit</a> as a base. Original README for devs...</summary>

# sv

Everything you need to build a Svelte project, powered by [`sv`](https://github.com/sveltejs/cli).

## Creating a project

If you're seeing this, you've probably already done this step. Congrats!

```sh
# create a new project in the current directory
npx sv create

# create a new project in my-app
npx sv create my-app
```

## Developing

Once you've created a project and installed dependencies with `npm install` (or `pnpm install` or `yarn`), start a development server:

```sh
npm run dev

# or start the server and open the app in a new browser tab
npm run dev -- --open
```

## Building

To create a production version of your app:

```sh
npm run build
```

You can preview the production build with `npm run preview`.

> To deploy your app, you may need to install an [adapter](https://svelte.dev/docs/kit/adapters) for your target environment.

</details>
