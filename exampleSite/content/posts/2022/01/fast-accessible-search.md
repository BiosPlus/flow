+++
title = "Building Fast and Accessible Search"
date = 2022-01-25T11:25:00+10:00
draft = false
tags = ["thought", "ux"]
toc = false
+++

Comparing client-side indexes, inverted indexes, and fuzzy scoring heuristics.

## Overview

This is an entry created to demonstrate and test pagination in the flow message list. When a blog grows to dozens, hundreds, or thousands of posts, pagination ensures the sidebar remains fast, lightweight, and responsive.

### Discussion

1. **DOM Efficiency**: Limiting the rendered stubs to a fixed page size prevents DOM bloat.
2. **Instant Navigation**: Static pagination allows instant transitions with view transition support.
3. **Smart Context Window**: Reading single posts renders only the relevant page bucket in the sidebar.

> Keep your static sites lean, accessible, and blazingly fast!
