# flow
Me experimenting with a new hugo theme for my blog

## Development

Run the following command for local development:
```sh
hugo server --disableFastRender
```
The `--disableFastRender` flag is required because every page's HTML depends on every other page due to the embedded list, and fast render will serve stale lists.
