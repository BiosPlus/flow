+++
title = "Lessons from Unix Tool Philosophy"
date = 2022-01-21T19:21:00+10:00
draft = false
tags = ["thought", "retro"]
toc = false
+++

Small programs that do one thing well, composing via standard text streams.

## Overview

This is an entry created to demonstrate and test pagination in the flow message list. When a blog grows to dozens, hundreds, or thousands of posts, pagination ensures the sidebar remains fast, lightweight, and responsive.

### Discussion

1. **DOM Efficiency**: Limiting the rendered stubs to a fixed page size prevents DOM bloat.
2. **Instant Navigation**: Static pagination allows instant transitions with view transition support.
3. **Smart Context Window**: Reading single posts renders only the relevant page bucket in the sidebar.

> Keep your static sites lean, accessible, and blazingly fast!
