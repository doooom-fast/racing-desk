"""The fleet build: one livery, laid on every car that has a paint template.

This is the pipeline that painted the DOOOOM fleet, brought in from the livery library's
``design/fleet`` scripts and the three ``iracing-*`` skills. Those were written on another machine
and named its disks; here every path is an argument, so the desk can run the same steps itself.

    cars.py       which car is which, and where iRacing publishes its template
    template.py   fetch a template, and read out of it what a build needs
    patches.py    the patches a sheet must leave alone, or paint on purpose
    shatter.py    the shard field over the whole sheet, in both directions
    logos.py      the logo pass: marks fitted onto panels, never cropped by them
    build.py      one car, or all of them, into the library

What it needs from the car is its template and nothing else: the shard field maps across the UV
sheet, so it lands on any car with no panel work. Logos do need to know the panels
(``data/panels/<car>.json``), which takes a look at the car's own stock schemes.

Templates are iRacing's files. They are fetched into the app's data folder, never into a
repository, and nothing here is given to anyone.
"""
