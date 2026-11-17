# Shopping list
items = []
while True:
    item = input("Item (blank to stop): ")
    if item == "":
        break
    items.append(item)
print("You need", len(items), "things")
