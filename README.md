# flow
Me experimenting with a new hugo theme for my blog

## Development

Run the following command for local development:
```sh
hugo server --disableFastRender
```
The `--disableFastRender` flag is required because every page's HTML depends on every other page due to the embedded list, and fast render will serve stale lists.
The media-conditioned @import in main.css successfully lowered into an @media block inside the bundled main.css file (tested via reading build/css/main.*.css)
