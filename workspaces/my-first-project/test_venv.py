import sys
print(f"Python: {sys.executable}")
print(f"Version: {sys.version.split()[0]}")
try:
    import pip
    print("pip: ok")
except ImportError:
    print("pip: not found")
