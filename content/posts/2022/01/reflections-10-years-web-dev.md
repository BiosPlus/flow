+++
title = "Reflections on 10 Years of Web Dev"
date = 2022-01-31T11:37:00+10:00
draft = false
tags = ["thought", "retro"]
toc = false
+++

From jQuery and LAMP stacks to static edge deployments and back to basics.

## Overview

This is an entry created to demonstrate and test pagination in the flow message list. When a blog grows to dozens, hundreds, or thousands of posts, pagination ensures the sidebar remains fast, lightweight, and responsive.

### Discussion

1. **DOM Efficiency**: Limiting the rendered stubs to a fixed page size prevents DOM bloat.
2. **Instant Navigation**: Static pagination allows instant transitions with view transition support.
3. **Smart Context Window**: Reading single posts renders only the relevant page bucket in the sidebar.

> Keep your static sites lean, accessible, and blazingly fast!
