🔒 Fix XSS Vulnerability in Image Processor

🎯 **What:** The `theme/flow/layouts/_partials/image-processor.html` template previously bypassed Go HTML template's native contextual escaping when constructing the `<figure>` class attribute by using `safeHTMLAttr` with string concatenation.

⚠️ **Risk:** If a malicious or crafted payload was passed into the `$class` variable (e.g., from front matter or shortcode arguments), it could break out of the HTML attribute and inject arbitrary attributes (like `onload="alert(1)"`), leading to Cross-Site Scripting (XSS).

🛡️ **Solution:** Removed the string concatenation and the `safeHTMLAttr` bypass. The class string is now constructed dynamically inside the class attribute itself (e.g. `class="{{ . }}"`), ensuring that Go's built-in HTML template engine safely escapes the variable's value against HTML attribute breakouts.

Preview of the render has been attached.
