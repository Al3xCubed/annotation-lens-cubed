# AnnotationLens³

This extension allows you to view information about class member overrides and implementations in the form of CodeLens annotations for JavaScript and TypeScript.

When a method or field is overriden, a clickable `@Override <name>` text appears that leads you to the method or field that is overriden, while stating the name of the class or interface of the original implementation.  
A lens with the text `@Implement <name>` shows above a method or property that implements an abstract method or property, or an interface.

## Showcase

> **Basic**: Below is an example of the basic functionality of this extension, `name` and `constructor` are being overridden from `Animal` which is reflected with the `@Override Animal` annotation. Clicking on this annotation selects the original implementation.  
> `speak()`, on the other hand, is being implemented which is why the annotation shows `@Implement Animal`. Clicking this annotation also selects the relevant class member.  
> ![Basic](images/showcase/basic.gif)

> **Implementing multiple interfaces**: If a class implements multiple interfaces, the annotations are shown for all these interfaces.  
>  ![Implementing Multiple Interfaces](images/showcase/implement_multiple_interfaces.gif)

> **Deep Annotations**: To find out whether a method or property is being overridden, it checks the entire tree of superclasses, so it even shows indirect overrides (`@Implement Animal` is shown at line 22, since `Fish` extends `Animal` which has a `speak()` method).  
> ![Deep Annotations](images/showcase/deep_annotations.gif)
